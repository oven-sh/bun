// The result of JSON.parse goes straight into the annotated variable.
interface Meta { sign: string[] | true; secrets?: string }
function read(text: string): string {
  const meta: Meta = JSON.parse(text);
  if (meta.sign) { meta.sign = true; return "signed " + JSON.stringify(meta); }
  meta.secrets = "none";
  return "plain " + JSON.stringify(meta);
}
console.log(read('{"path":"/"}'));
console.log(read('{"sign":["a"]}'));
console.log(read('{"sign":7,"secrets":[1]}'));
console.log(read('[1,2]'));
