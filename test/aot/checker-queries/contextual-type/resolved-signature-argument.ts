// An argument's contextual type is the parameter type of the resolved signature.
interface Options { port: number }
function listen(options: Options) {}
listen({ port: 1 });
export {};
