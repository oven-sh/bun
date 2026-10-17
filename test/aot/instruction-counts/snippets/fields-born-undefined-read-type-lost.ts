// reads three fields that were born undefined, one of them stored since, through a parameter of type any
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
const replies: any[] = [];
for (let i = 0; i < operations; i++) {
  const reply = make("/");
  reply.fourth = "4";
  replies.push(reply);
}
let statusMessage: any, size: any, fourth: any;
const read = (reply: any) => {
  statusMessage = reply.statusMessage;
  size = reply.size;
  fourth = reply.fourth;
};

kernel: {
  for (let i = 0; i < replies.length; i++) read(replies[i]);
}

console.log(statusMessage, size, fourth);
