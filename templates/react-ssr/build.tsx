const BUN_EXE = process.env.BUN_EXE || "bun";

export async function build(params: {
  entryNames?: string;
  outdir?: string;
  platform?: string;
  rsc?: boolean;
  splitting?: boolean;
  entrypoints?: string[];
  env: Record<string, string>;
}) {
  const args = [BUN_EXE, "build"] as [string, ...string[]];
  if (params.entryNames) {
    args.push(`--entry-names=${params.entryNames}`);
  }
  if (params.outdir) {
    args.push(`--outdir=${params.outdir}`);
  }
  if (params.rsc) {
    args.push("--server-components");
  }
  if (params.splitting) {
    args.push("--splitting");
  }
  if (params.platform) {
    args.push(`--platform=${params.platform}`);
  }
  if (params.entrypoints) {
    args.push(...params.entrypoints);
  }
  console.log(args);

  const proc = Bun.spawn(args, {
    cwd: import.meta.dir,
    stderr: "inherit",
    env: params.env || {},
  });

  const text = await new Response(proc.stdout).text();
  console.log(text);

  return "done";
}
