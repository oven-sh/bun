// replaces the value of a property that the class does not declare, through a parameter of type any
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
const write = (message: any, value: number): void => {
  message.params = value;
};
let total = 0;

kernel: {
  for (let i = 0; i < messages.length; i++) write(messages[i], i);
  total += messages[7].params;
}

console.log(total);
