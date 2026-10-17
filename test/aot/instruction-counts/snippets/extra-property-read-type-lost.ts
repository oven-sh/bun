// reads a property that the class does not declare, through a parameter of type any
class Message {
  url = "/";
  next: Message | null = null;
}
const operations = 100;
const messages: any[] = [];
for (let i = 0; i < operations; i++) {
  const message: any = new Message();
  message.params = i;
  messages.push(message);
}
const read = (message: any): number => message.params;
let total = 0;

kernel: {
  for (let i = 0; i < messages.length; i++) total += read(messages[i]);
}

console.log(total);
