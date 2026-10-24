// A program that adds a member to an interface of the default library does not make it a type of its own: it still names the built-in class.
interface User { name: string }
declare global { interface Request { user?: User } }
let request: Request;
export {};
