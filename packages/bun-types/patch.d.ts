declare module "bun:patch" {
  export function apply(patchFile: string, dir?: string): Promise<void>;
}
