// replaces the values of four declared fields of a class instance that comes out of a Map whose values are of type any
class Message {
  url = "/";
  status = 200;
  sent = false;
  next: Message | null = null;
}
const operations = 100;
const messages = new Map<number, any>();
for (let i = 0; i < operations; i++) messages.set(i, new Message());
const write = (message: any, url: any, status: any, sent: any, next: any) => {
  message.url = url;
  message.status = status;
  message.sent = sent;
  message.next = next;
};

kernel: {
  for (let i = 0; i < operations; i++) write(messages.get(i), "/a", 404, true, messages.get(0));
}

console.log(messages.get(7).url, messages.get(7).status, messages.get(7).sent, messages.get(7).next === messages.get(0));
