// makes a record of sixteen fields, twelve of them born undefined, and stores to three of those
interface Reply {
  statusCode: number;
  sent: boolean;
  url: string;
  peer: object | null;
  statusMessage: string | undefined;
  header: string | undefined;
  trailer: string | undefined;
  timeout: number | undefined;
  encoding: string | undefined;
  chunked: boolean | undefined;
  size: number | undefined;
  upgrade: object | undefined;
  first: string | undefined;
  second: string | undefined;
  third: string | undefined;
  fourth: string | undefined;
}
const make = (url: string): Reply => ({
  statusCode: 200,
  sent: false,
  url,
  peer: null,
  statusMessage: undefined,
  header: undefined,
  trailer: undefined,
  timeout: undefined,
  encoding: undefined,
  chunked: undefined,
  size: undefined,
  upgrade: undefined,
  first: undefined,
  second: undefined,
  third: undefined,
  fourth: undefined,
});
const operations = 100;
let last = make("/");

kernel: {
  for (let i = 0; i < operations; i++) {
    const reply = make("/");
    reply.statusMessage = "OK";
    reply.size = i;
    reply.fourth = "4";
    last = reply;
  }
}

console.log(last.statusMessage, last.size, last.fourth, last.third);
