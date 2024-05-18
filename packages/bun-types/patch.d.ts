declare module "bun:patch" {
  export function applySync(patchFile: string, dir?: string): void;
  export function apply(patchFile: string, dir?: string): Promise<void>;
}
