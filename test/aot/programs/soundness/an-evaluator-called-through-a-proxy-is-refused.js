try { console.log(new (new Proxy(Function, {}))("return 5")()); } catch (error) { console.log(error.name); }
try { console.log(new Proxy(eval, {})("6")); } catch (error) { console.log(error.name); }
