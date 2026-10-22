console.log(new Proxy(new Proxy(Function, {}), {})("return 4")());
