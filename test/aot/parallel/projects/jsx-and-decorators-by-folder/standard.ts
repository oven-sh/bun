export let count = 0;
function mark(value: Function, context: ClassDecoratorContext) { count = arguments.length; }
@mark
class Marked {}
export const name = Marked.name;
