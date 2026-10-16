// Runs the generators of a WebKit checkout. They need perl, python3 and ruby.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Binding } from "./bindings.ts";
import { editSVGTagNames, editTagNames } from "./names.ts";
import type { Files } from "./util.ts";

export class Upstream {
  /** `webcore` is Source/WebCore of a WebKit checkout. `scratch` is an empty directory for what the generators write. */
  constructor(
    readonly webcore: string,
    readonly scratch: string,
  ) {
    if (!fs.existsSync(path.join(webcore, "bindings/scripts/generate-bindings.pl")))
      throw new Error(
        `${webcore} is not Source/WebCore of a WebKit checkout. Give its path with --webcore=<directory> or in WEBCORE_SOURCE_DIR.`,
      );
  }

  private directory(name: string): string {
    const directory = path.join(this.scratch, name);
    fs.mkdirSync(directory, { recursive: true });
    return directory;
  }

  private get environment() {
    return { ...process.env, PERL5LIB: path.join(this.webcore, "bindings/scripts") };
  }

  private run(cwd: string, command: string, ...args: string[]): void {
    const result = Bun.spawnSync([command, ...args], { cwd, env: this.environment, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(`${command} ${args.join(" ")}\n${result.stdout}${result.stderr}`);
  }

  private static read(directory: string, names = fs.readdirSync(directory)): Files {
    return new Map(names.sort().map(name => [name, fs.readFileSync(path.join(directory, name), "utf8")]));
  }

  /** What dom/make_names.pl prints for the tags and attributes of HTML, SVG, MathML, XLink, XML and XMLNS. */
  makeNames(): Files {
    const out = this.directory("names");
    const source = (file: string) => path.join(this.webcore, file);
    const tags = path.join(this.scratch, "HTMLTagNames.in");
    fs.writeFileSync(tags, editTagNames(fs.readFileSync(source("html/HTMLTagNames.in"), "utf8")));
    const makeNames = (...args: string[]) => this.run(out, "perl", source("dom/make_names.pl"), ...args);

    makeNames("--elements", tags, "--attrs", source("html/HTMLAttributeNames.in"), "--factory", "--wrapperFactory");
    // All the names of SVG and MathML: the HTML tree builder needs them for foreign content.
    makeNames("--elements", source("svg/svgtags.in"), "--attrs", source("svg/svgattrs.in"));
    makeNames("--elements", source("mathml/mathtags.in"), "--attrs", source("mathml/mathattrs.in"));
    for (const attributes of ["svg/xlinkattrs.in", "xml/xmlnsattrs.in", "xml/xmlattrs.in"])
      makeNames("--attrs", source(attributes));
    // prettier-ignore
    const all = [
      "--elements", tags, "--elements", source("svg/svgtags.in"), "--elements", source("mathml/mathtags.in"),
      "--attrs", source("html/HTMLAttributeNames.in"), "--attrs", source("mathml/mathattrs.in"), "--attrs", source("svg/svgattrs.in"),
      "--attrs", source("svg/xlinkattrs.in"), "--attrs", source("xml/xmlattrs.in"), "--attrs", source("xml/xmlnsattrs.in"),
    ];
    for (const enumeration of ["TagName", "NodeName", "Namespace"]) makeNames("--enum", enumeration, ...all);
    const files = Upstream.read(out);

    // The factories of SVG, from a second run that sees only the tags that have a class.
    const factories = this.directory("svg-factories");
    const svgTags = path.join(this.scratch, "svgtags.in");
    fs.writeFileSync(svgTags, editSVGTagNames(fs.readFileSync(source("svg/svgtags.in"), "utf8")));
    // prettier-ignore
    this.run(factories, "perl", source("dom/make_names.pl"),
      "--elements", svgTags, "--attrs", source("svg/svgattrs.in"), "--factory", "--wrapperFactory");
    // prettier-ignore
    const made = ["SVGElementFactory.cpp", "SVGElementFactory.h", "JSSVGElementWrapperFactory.cpp", "JSSVGElementWrapperFactory.h", "SVGElementTypeHelpers.h"];
    for (const [name, text] of Upstream.read(factories, made)) files.set(name, text);
    return files;
  }

  /** Generated files that Bun takes as they are. */
  makeOtherFiles(): Files {
    const out = this.directory("other");
    const source = (file: string) => path.join(this.webcore, file);
    this.run(
      out,
      "python3",
      source("html/parser/create-html-entity-table"),
      "-o",
      "HTMLEntityTable.cpp",
      source("html/parser/HTMLEntityNames.in"),
    );
    this.run(
      out,
      "ruby",
      source("domjit/generate-abstract-heap.rb"),
      source("domjit/DOMJITAbstractHeapRepository.yaml"),
      "DOMJITAbstractHeapRepository.h",
    );
    // The script also makes two perfect hash tables with gperf. Bun parses selectors in Rust and wants the enumerations only.
    fs.copyFileSync(source("css/CSSPseudoSelectors.json"), path.join(out, "CSSPseudoSelectors.json"));
    this.run(
      out,
      "python3",
      source("css/scripts/process-css-pseudo-selectors.py"),
      "--gperf-executable",
      "true",
      "--defines",
      "",
    );
    return Upstream.read(out, ["CSSSelectorEnums.h", "DOMJITAbstractHeapRepository.h", "HTMLEntityTable.cpp"]);
  }

  private idlFiles = new Map<string, string>(); // "Node" -> the path of Node.idl
  private idlFileNamesList = "";
  private supplementalDependencies = "";

  /**
   * Finds every IDL file and works out which partial interfaces and mixins belong to which interface.
   * A file in `editedIDLDirectory` wins over upstream's file of the same name, also when another interface refers to it.
   */
  preprocessIDLFiles(editedIDLDirectory: string): void {
    const excluded = [
      /\/bindings\/scripts\/test\//,
      /\/css\/scripts\/test\//,
      /\/testing\//,
      /\/CSSStyleRule\+Typedom\.idl$/, // `partial interface CSSStyleRule`: Bun has no CSS Typed OM.
      /\/Navigator\+\w+\.idl$/, // `partial interface Navigator`: clipboard, geolocation, media devices and so on, which Bun does not have.
    ];
    const add = (directory: string) => {
      for (const entry of fs
        .readdirSync(directory, { withFileTypes: true })
        .sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) add(full);
        else if (
          entry.name.endsWith(".idl") &&
          !excluded.some(pattern => pattern.test(full)) &&
          !this.idlFiles.has(entry.name.slice(0, -4))
        )
          this.idlFiles.set(entry.name.slice(0, -4), full);
      }
    };
    add(editedIDLDirectory);
    add(this.webcore);

    const out = this.directory("idl");
    this.idlFileNamesList = path.join(out, "IDLFileNamesList.txt");
    this.supplementalDependencies = path.join(out, "SupplementalDependencies.txt");
    fs.writeFileSync(this.idlFileNamesList, [...this.idlFiles.values()].join("\n") + "\n");
    // prettier-ignore
    this.run(out, "perl", path.join(this.webcore, "bindings/scripts/preprocess-idls.pl"),
      "--defines", "LANGUAGE_JAVASCRIPT",
      "--idlFileNamesList", this.idlFileNamesList,
      "--idlAttributesFile", path.join(this.webcore, "bindings/scripts/IDLAttributes.json"),
      "--supplementalDependencyFile", this.supplementalDependencies,
      // Bun has lists of its own (lists.ts) in place of the rest, but the script insists on writing them.
      "--isoSubspacesHeaderFile", "DOMIsoSubspaces.h",
      "--clientISOSubspacesHeaderFile", "DOMClientIsoSubspaces.h",
      "--constructorsHeaderFile", "DOMConstructors.h",
      "--windowConstructorsFile", "DOMWindowConstructors.idl",
      "--workerGlobalScopeConstructorsFile", "WorkerGlobalScopeConstructors.idl",
      "--dedicatedWorkerGlobalScopeConstructorsFile", "DedicatedWorkerGlobalScopeConstructors.idl",
      "--serviceWorkerGlobalScopeConstructorsFile", "ServiceWorkerGlobalScopeConstructors.idl",
      "--sharedWorkerGlobalScopeConstructorsFile", "SharedWorkerGlobalScopeConstructors.idl",
      "--workletGlobalScopeConstructorsFile", "WorkletGlobalScopeConstructors.idl",
      "--paintWorkletGlobalScopeConstructorsFile", "PaintWorkletGlobalScopeConstructors.idl",
      "--audioWorkletGlobalScopeConstructorsFile", "AudioWorkletGlobalScopeConstructors.idl",
      "--supplementalMakefileDeps", "SupplementalDependencies.dep",
    );
  }

  /** What bindings/scripts/CodeGeneratorJS.pm prints for each interface, dictionary, enumeration or callback: name -> files. */
  async generateBindings(names: string[]): Promise<Map<string, Binding>> {
    const out = this.directory("bindings");
    for (const name of names) if (!this.idlFiles.has(name)) throw new Error(`there is no ${name}.idl`);
    const queue = [...names];
    const worker = async () => {
      for (let name = queue.pop(); name; name = queue.pop()) {
        // prettier-ignore
        const generator = Bun.spawn(["perl", path.join(this.webcore, "bindings/scripts/generate-bindings.pl"),
          "--defines", "LANGUAGE_JAVASCRIPT",
          "--generator", "JS",
          "--outputDir", out,
          "--idlFileNamesList", this.idlFileNamesList,
          "--idlAttributesFile", path.join(this.webcore, "bindings/scripts/IDLAttributes.json"),
          "--supplementalDependencyFile", this.supplementalDependencies,
          this.idlFiles.get(name)!,
        ], { env: this.environment, stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, exitCode] = await Promise.all([
          generator.stdout.text(),
          generator.stderr.text(),
          generator.exited,
        ]);
        if (exitCode !== 0) throw new Error(`generate-bindings.pl failed for ${name}.idl\n${stdout}${stderr}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(os.availableParallelism(), 16) }, worker));
    const read = (file: string) => fs.readFileSync(path.join(out, file), "utf8");
    return new Map(names.map(name => [name, { header: read(`JS${name}.h`), implementation: read(`JS${name}.cpp`) }]));
  }
}
