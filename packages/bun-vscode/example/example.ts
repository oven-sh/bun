export default {
  async fetch(request: Request): Promise<Response> {
    a(request);
    const object = {
      a: "1",
      b: "2",
      c: new Map([[1, 2]]),
    };
    const coolThing: CoolThing = new SuperCoolThing();
    coolThing.doCoolThing();
    return new Response("Hello World!!");
  },
};

// a
function a(request: Request): void {
  b(request);
}

// b
function b(request: Request): void {
  c(request);
}

// c
function c(request: Request) {
  console.log(request);
}

interface CoolThing {
  doCoolThing(): void;
}

class SuperCoolThing implements CoolThing {
  doCoolThing(): void {
    console.log("BLAH BLAH", new Map([[1, 2]]));
  }
}
