// reads four declared fields of a class instance through a parameter of type any
class Message {
  url = "/";
  status = 200;
  sent = false;
  next: Message | null = null;
}
const operations = 100;
const messages: any[] = [];
for (let i = 0; i < operations; i++) messages.push(new Message());
let url: any, status: any, sent: any, next: any;
const read = (message: any) => {
  url = message.url;
  status = message.status;
  sent = message.sent;
  next = message.next;
};

kernel: {
  for (let i = 0; i < messages.length; i++) read(messages[i]);
}

console.log(url, status, sent, next);
