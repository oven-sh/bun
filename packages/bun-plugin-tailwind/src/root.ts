// Follows the class of the same name in `@tailwindcss/vite` (MIT License, Copyright (c) Tailwind Labs, Inc.).
import { compile, Features, Instrumentation, normalizePath } from "@tailwindcss/node";
import { clearRequireCache } from "@tailwindcss/node/require-cache";
import { Scanner } from "@tailwindcss/oxide";
import fs from "node:fs/promises";
import path from "node:path";
import { native, type TailwindContext } from "./native.ts";

type Compiler = Awaited<ReturnType<typeof compile>>;

/** A stylesheet that the bundler loads. */
export class Root {
  // Kept between rebuilds, and set up again when the stylesheet or a build dependency changed.
  private compiler?: Compiler;
  private scanner?: Scanner;
  private content?: string;

  // Every candidate that `scanner` returned.
  private candidates = new Set<string>();

  // Imported stylesheets, configs and plugins with their modification time. `null`: always treated as changed.
  private buildDependencies = new Map<string, number | null>();

  constructor(
    private inputPath: string,
    private base: string,
    private context: TailwindContext | undefined,
  ) {}

  /**
   * The generated CSS, or `false` if `content` does not use Tailwind.
   * @param defer resolves once the bundler has parsed the rest of the module graph
   */
  async generate(content: string, defer: () => Promise<void>): Promise<string | false> {
    // Prints its timings when `DEBUG` names Tailwind.
    using I = new Instrumentation();
    I.start("[bun-plugin-tailwind] Generate CSS");

    const compiler = await this.compile(content, I);
    if (
      !(
        compiler.features &
        (Features.AtApply | Features.JsPluginCompat | Features.ThemeFunction | Features.Utilities | Features.Variants)
      )
    ) {
      return false;
    }

    let candidates: string[] = [];
    if (compiler.features & Features.Utilities) {
      // The disk is scanned while the bundler's threads parse the modules.
      I.start("Scan the disk");
      for (const candidate of this.scanner!.scan()) {
        this.candidates.add(candidate);
      }
      I.end("Scan the disk");

      // Until then the native hook has not seen the whole module graph.
      await defer();

      I.start("Read the module graph");
      candidates = [...this.candidates, ...this.moduleCandidates(compiler)];
      I.end("Read the module graph");
    }

    I.start("Build CSS");
    const code = compiler.build(candidates);
    I.end("Build CSS");
    return code;
  }

  /** What the native hook found in the modules that `source(…)` and `@source not` let in. */
  private moduleCandidates({ root, sources }: Compiler): string[] {
    if (!native || !this.context || root === "none") return [];
    return native.twctxCandidates(
      this.context,
      root && resolvePattern(root),
      sources.filter(source => source.negated).map(resolvePattern),
    );
  }

  private async compile(content: string, I: Instrumentation): Promise<Compiler> {
    if (this.compiler && this.content === content && !(await this.requiresBuild())) {
      return this.compiler;
    }

    const previous = Array.from(this.buildDependencies.keys());
    clearRequireCache(previous);
    this.buildDependencies.clear();
    this.content = content;

    I.start("Setup compiler");
    const pending: Promise<void>[] = [];
    let compiler: Compiler;
    try {
      compiler = await compile(content, {
        base: path.dirname(path.resolve(this.inputPath)),
        shouldRewriteUrls: true,
        onDependency: dependency => {
          pending.push(this.addBuildDependency(dependency));
        },
      });
    } catch (error) {
      // Until the stylesheet or one of these files changes, builds go on with the last compiler that worked: Bun's dev
      // server bundles again for the next request, and can lose the `<link>` to a stylesheet that fails twice in a row.
      pending.push(...previous.map(dependency => this.addBuildDependency(dependency)));
      throw error;
    } finally {
      await Promise.all(pending);
    }
    I.end("Setup compiler");

    const { root } = compiler;
    const sources =
      root === "none"
        ? []
        : root === null
          ? [{ base: normalizePath(this.base), pattern: "**/*", negated: false }]
          : [{ ...root, negated: false }];
    this.scanner = new Scanner({ sources: sources.concat(compiler.sources) });
    this.candidates.clear();
    this.compiler = compiler;
    return compiler;
  }

  private async addBuildDependency(file: string) {
    let mtime: number | null = null;
    try {
      mtime = (await fs.stat(file)).mtimeMs;
    } catch {}
    this.buildDependencies.set(file, mtime);
  }

  private async requiresBuild(): Promise<boolean> {
    for (const [file, mtime] of this.buildDependencies) {
      if (mtime === null) return true;
      try {
        if ((await fs.stat(file)).mtimeMs > mtime) return true;
      } catch {
        return true;
      }
    }
    return false;
  }
}

function resolvePattern(source: { base: string; pattern: string }): string {
  return normalizePath(path.resolve(source.base, source.pattern));
}
