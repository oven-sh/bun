export class Base { id = 1; who() { return "base" + this.id; } }
export let Swapped = class { id = 2; who() { return "first" + this.id; } };
export function swap() { Swapped = class { id = 3; who() { return "second" + this.id; } }; }
export default class Main extends Base { main = 4; }
