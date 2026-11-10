var uses;
const said = [];
function go() {
  for (const name of Object.getOwnPropertyNames(uses)) said.push(name + " " + uses[name](require(name)));
}
uses = {
  zlib(found) {
    return typeof found.gzipSync;
  },
};
go();
uses = {
  path(found) {
    return typeof found.join;
  },
};
go();
uses = {
  url(found) {
    return typeof found.parse;
  },
};
go();
console.log(said.join(";"));
