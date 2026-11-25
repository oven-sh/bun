function place(address: URL, host: string, port: string): void {
  address.hostname = host;
  address.port = port;
}
(globalThis as any).placeByStrangers = place;
const placeAny = (value: unknown): string => {
  try {
    (globalThis as any).placeByStrangers(value, "stored.example", "81");
    return "stored";
  } catch (error) {
    return (error as Error).constructor.name + ": " + (error as Error).message;
  }
};
const others: [string, object][] = [
  ["URLSearchParams", new URLSearchParams("a=1")],
  ["Map", new Map()],
  ["Set", new Set()],
  ["Blob", new Blob(["x"])],
  ["Headers", new Headers()],
  ["Request", new Request("https://request.example/")],
  ["Response", new Response("y")],
  ["Date", new Date(0)],
  ["RegExp", /z/],
  ["Uint8Array", new Uint8Array(2)],
  ["Buffer", Buffer.from("b")],
  ["Error", new Error("e")],
  ["Promise", Promise.resolve(1)],
  ["WeakMap", new WeakMap()],
  ["ArrayBuffer", new ArrayBuffer(1)],
  ["TextEncoder", new TextEncoder()],
  ["AbortController", new AbortController()],
  ["EventTarget", new EventTarget()],
  ["FormData", new FormData()],
];
for (const [name, other] of others) {
  console.log(name, placeAny(other), (other as any).hostname, (other as any).port, Object.getOwnPropertyNames(other).filter(own => own === "hostname" || own === "port").join());
}
const real = new URL("https://real.example/");
console.log(placeAny(real), real.href);
