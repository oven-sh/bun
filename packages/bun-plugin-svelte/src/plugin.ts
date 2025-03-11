import { basename } from "node:path";
import type { BuildConfig, Transpiler } from "bun";
import { getBaseCompileOptions, getBaseModuleCompileOptions, hash, type SvelteOptions } from "./options";
import { compile, type CompileOptions, type CompileResult, type ModuleCompileOptions } from "svelte/compiler";

const virtualNamespace = "bun-svelte";

export class SveltePluginService {
  private compileOptions: CompileOptions;
  private compileModuleOptions: ModuleCompileOptions;

  private ts: Transpiler;
  /** Virtual CSS modules created by Svelte components. Keys are import specifiers. */
  private css: Map<string, VirtualCSSModule>;

  constructor(options: SvelteOptions, config: Partial<BuildConfig>) {
    this.compileOptions = getBaseCompileOptions(options, config);
    this.compileModuleOptions = getBaseModuleCompileOptions(options, config);

    this.ts = new Bun.Transpiler({ loader: "ts" });
    this.css = new Map();
  }

  public compileComponent(source: string, filename: string, hmr: boolean, side?: "client" | "server"): CompileResult {
    const generate = this.compileOptions.generate ?? side;
    const result = compile(source, {
      ...this.compileOptions,
      generate,
      filename,
      hmr,
    });

    var { js, css } = result;
    if (css?.code && generate != "server") {
      const uid = `${basename(filename)}-${hash(filename)}-style`.replaceAll(`"`, `'`);
      const virtualName = virtualNamespace + ":" + uid + ".css";
      this.css.set(virtualName, { sourcePath: filename, source: css.code });
      js.code += `\nimport "${virtualName}";`;
    }

    return result;
  }

  public async compileModule(source: string, filename: string, side?: "client" | "server"): Promise<CompileResult> {
    const generate = this.compileModuleOptions.generate ?? side;
    if (filename.endsWith("ts")) {
      source = await this.ts.transform(source);
    }

    // NOTE: we assume js/ts modules won't have CSS blocks in them, so no
    // virtual modules get created.
    return compile(source, {
      ...this.compileModuleOptions,
      generate,
      filename,
    });
  }

  public takeVirtualCSSModule(path: string): VirtualCSSModule {
    const mod = this.css.get(path);
    if (!mod) throw new Error("Virtual CSS module not found: " + path);
    this.css.delete(path);
    return mod;
  }
}

type VirtualCSSModule = {
  /** Path to the svelte file whose css this is for */
  sourcePath: string;
  /** Source code  */
  source: string;
};
