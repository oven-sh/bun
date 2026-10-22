// The result of JSON.parse goes straight into the annotated variable. Any object enters, an array too, and a member it does not have reads undefined. A member of another kind throws at its typed read.
interface Meta { sign: string[] | true; secrets?: string }
function read(text: string): string {
  const meta: Meta = JSON.parse(text);
  if (meta.sign) { meta.sign = true; return "signed " + JSON.stringify(meta); }
  meta.secrets = "none";
  return "plain " + JSON.stringify(meta);
}
console.log(read('{"path":"/"}'));
console.log(read('{"sign":["a"]}'));
try { console.log(read('{"sign":7,"secrets":[1]}')); } catch (e) { console.log("a number for sign:", (e as Error).constructor.name); }
console.log(read('[1,2]'));
