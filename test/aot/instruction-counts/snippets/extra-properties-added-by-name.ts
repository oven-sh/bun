// makes an instance of a class and gives it three properties that the class does not declare, by name
class Message {
  url = "/";
  next: Message | null = null;
}
const operations = 100;
const messages: any[] = [];
for (let i = 0; i < operations; i++) messages.push(null);
const give = (message: any, value: number): void => {
  message.params = value;
  message.query = value;
  message.route = value;
};
let total = 0;

kernel: {
  for (let i = 0; i < messages.length; i++) {
    const message = new Message();
    give(message, i);
    messages[i] = message;
  }
  total += messages[7].route;
}

console.log(total);
