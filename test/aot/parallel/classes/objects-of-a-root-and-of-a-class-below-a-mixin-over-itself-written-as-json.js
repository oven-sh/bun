// Flags: --aot-verify-each-pass
// One function writes the objects of a layout as JSON, and several functions call it. What a caller hands it takes the type of its parameter, which was made while another function was compiled.
function fieldsAllTheWayUp() {
  function mkRoot() { return class Root { r = 1; }; }
  const Root = mkRoot();
  const mix = (B0) => class extends B0 { m = (this.m ?? 0) + 2; };
  const make = () => mix(mix(Root));
  class SA extends make() { a = 3; }
  const root = new Root();
  console.log(JSON.stringify(root));
  console.log(JSON.stringify(new SA()));
}
for (let round = 0; round < 2; round++) fieldsAllTheWayUp();
