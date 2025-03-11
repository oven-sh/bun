import path from "node:path";
import { compileScript, compileTemplate, parse } from "@vue/compiler-sfc";
import type { CompilerError, SFCDescriptor, SFCParseOptions, SFCScriptBlock, SFCStyleCompileResults, SFCTemplateBlock, SFCTemplateCompileResults } from "@vue/compiler-sfc";
import assert from "node:assert";

/**
 * @see https://play.vuejs.org
 */
export class VirtualModuleService {
  private readonly root: string;
  private readonly ssr: boolean = false;
  private readonly sourceMap: boolean = true;

  private scriptCache: Map<SFCDescriptor, SFCScriptBlock> = new Map();
  private templateCache: Map<SFCDescriptor, SFCTemplateCompileResults> = new Map();
  private styleCache: Map<SFCDescriptor, SFCStyleCompileResults> = new Map();

  constructor(root: string) {
    this.root = root;
  }

  public registerSFC(descriptor: SFCDescriptor): void {
    const { script, scriptSetup, slotted, styles, template } = descriptor
    // TODO: canInlineMain

    const name = path.basename(descriptor.filename).split('.')[0];
    assert(name && typeof name === 'string');
    const relative = path.relative(this.root, descriptor.filename);

    let facade = '';

    if (script || scriptSetup) {
      const compiled = this.compileScript(descriptor);
      console.log(compiled)
      facade += /* js */ `import ${name} from "${relative}";\n`;
    }

    if (template) {
      facade += compiled.code + '\n';
    }
  }

  private compileTemplate(descriptor: SFCDescriptor) {
    const { template } = descriptor;
    assert(template);
    const cached = this.templateCache.get(descriptor);
    if (cached) return cached;
    const compiled = compileTemplate({
      id: 'bun',
      source: template.content,
      filename: descriptor.filename,
      compilerOptions: {
        ssr: this.ssr,
        scopeId: descriptor.styles.some(s => s.scoped) ? `data-v-${name}` : undefined,
      },
    });
    this.templateCache.set(descriptor, compiled);
    return compiled

  }


  private compileScript(descriptor: SFCDescriptor): SFCScriptBlock {
    const cached = this.scriptCache.get(descriptor);
    if (cached) return cached;

    const script = compileScript(descriptor, {
      id: 'bun', // todo: vite uses descriptor.id but that doesn't exist(?)
      sourceMap: this.sourceMap,
      isProd: false,
    });
    this.scriptCache.set(descriptor, script);
    return script;
  }

}
