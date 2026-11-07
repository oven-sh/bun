function mark(_target: unknown, _key: string) {}
const build = (round: number) => {
  class Registry {
    static names = ["a", "b"];
    @mark static size = eval("Registry.names.length + round");
    @mark static self = eval("typeof this");
  }
  return Registry.size + ":" + Registry.self;
};
function inFunction(this: unknown, round: number) {
  class Registry {
    static names = ["a"];
    @mark static size = eval("Registry.names.length + round");
    @mark static self = eval("typeof this");
  }
  return Registry.size + ":" + Registry.self;
}
console.log(build(1), inFunction.call("text", 2));
