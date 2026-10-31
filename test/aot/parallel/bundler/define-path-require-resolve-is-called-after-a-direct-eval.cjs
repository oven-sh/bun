// A call of a name whose `--define` value is `require.resolve` asks for no file where its argument names a built-in module, so the build lets it through. Behind a direct `eval` it finds the `require` of the file, or what the evaluated text declared under that name.
// Flags: --define RES=require.resolve
function find(text) {
  eval(text);
  return RES("node:path");
}
console.log(find(""), "|", find("var require = { resolve: name => 'declared by the text: ' + name }"));
