class Hidden<T> { hello() { return "behind an unnamed default export"; } }
export default class extends Hidden<number> {}
