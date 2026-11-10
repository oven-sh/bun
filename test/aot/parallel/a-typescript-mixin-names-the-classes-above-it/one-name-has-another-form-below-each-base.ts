type Made<T = object> = new (...args: any[]) => T;
class Whole { mark = 3; read(): string { return "whole " + (this.mark + 1); } }
class Text { mark = "m"; read(): string { return "text " + (this.mark + 1); } }
class Part { mark = 0.5; extra = true; read(): string { return "part " + (this.mark + 1) + this.extra; } }
function noted<B extends Made<{ read(): string }>>(Base: B) { return class Noted extends Base { note = "n"; read(): string { return super.read() + " " + this.note; } }; }
const NotedWhole = noted(Whole), NotedText = noted(Text), NotedPart = noted(Part);
for (const made of [new NotedWhole(), new NotedText(), new NotedPart(), new NotedWhole()]) console.log(made.read(), typeof made.mark, Object.keys(made).join());
