function g(o) { return o.mine; } function lay(o) { o.mine = () => "laid"; } lay(globalThis); console.log(g(globalThis)());
