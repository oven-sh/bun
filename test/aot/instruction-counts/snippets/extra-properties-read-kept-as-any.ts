// reads two properties that the class does not declare, through a parameter of type any, and keeps them as they are
class Message {
  url = "/";
  next: Message | null = null;
}
const operations = 100;
const messages: any[] = [];
for (let i = 0; i < operations; i++) {
  const message: any = new Message();
  message.params = { id: i };
  message.route = "r";
  messages.push(message);
}
let params: any, route: any;
const read = (message: any) => {
  params = message.params;
  route = message.route;
};

kernel: {
  for (let i = 0; i < messages.length; i++) read(messages[i]);
}

console.log(params.id, route);
