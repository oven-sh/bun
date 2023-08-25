export default {
  async fetch(request: Request): Promise<Response> {
    a(request);
    const coolThing: CoolThing = new SuperCoolThing();
    coolThing.doCoolThing();
    debugger;
    return new Response("HELLO WHAT!");
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
    console.log("BLAH BLAH");
  }
}
