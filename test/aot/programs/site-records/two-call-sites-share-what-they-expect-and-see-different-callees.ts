// Two calls of one method name with one argument count on one class share what they expect and what they learn. Each keeps getting receivers of its own, whose methods differ.
class Handler {
  id = "handler";
  handle(input: number): string {
    return this.id + " handles " + input;
  }
}
class Doubler {
  id = "doubler";
  handle(input: number): string {
    return this.id + " doubles to " + input * 2;
  }
}
class Negator {
  spare = 0;
  id = "negator";
  handle(input: number): string {
    return this.id + " negates to " + -input;
  }
}

function here(handler: Handler): string {
  return handler.handle(1);
}
function there(handler: Handler): string {
  return handler.handle(2);
}
function hereWithTwo(handler: Handler): string {
  return (handler as any).handle(3, 4);
}
function byValueHere(handle: (input: number) => string): string {
  return handle(5);
}
function byValueThere(handle: (input: number) => string): string {
  return handle(6);
}

const handler = new Handler();
const doubler = new Doubler();
const negator = new Negator();
const literal = { id: "literal", handle: (input: number) => "literal takes " + input };
const ownMethod = new Handler();
ownMethod.handle = input => "own method takes " + input;

function round(mark: string): void {
  console.log(mark, "|", here(doubler), "|", there(negator), "|", here(doubler), "|", there(negator));
  console.log(mark, "|", here(negator), "|", there(doubler), "|", hereWithTwo(doubler), "|", hereWithTwo(negator));
  console.log(mark, "|", here(handler), "|", there(literal), "|", here(ownMethod), "|", there(handler));
  console.log(mark, "|", byValueHere(literal.handle), "|", byValueThere(ownMethod.handle), "|", byValueHere(ownMethod.handle), "|", byValueThere(literal.handle));
  console.log(mark, "|", byValueHere(doubler.handle.bind(doubler)), "|", byValueThere(negator.handle.bind(negator)), "|", byValueHere(handler.handle.bind(negator)));
}

round("first");
round("second");
Doubler.prototype.handle = function (this: Doubler, input: number) {
  return this.id + " now triples to " + input * 3;
};
round("third");

export {};
