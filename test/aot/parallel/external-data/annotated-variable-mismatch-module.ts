// The annotated variable is a variable of the module.
interface Meta { sign: string[] | true; secrets?: string }
const source: any = { cookie: { path: "/" } };
const meta: Meta = source.cookie;
export function describe(): string {
  if (meta.sign) { meta.sign = true; return "signed"; }
  meta.secrets = "none";
  return "plain " + JSON.stringify(source);
}
console.log(describe());
