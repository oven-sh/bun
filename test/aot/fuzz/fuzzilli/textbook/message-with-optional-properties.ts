interface Message {
  to: string;
  subject?: string;
  body?: string;
}
function draft(to: string): Message {
  return { to };
}
function run() {
  const message = draft("ann");
  message.subject = "hello";
  console.log(JSON.stringify(message), message.body, Object.keys(message).join());
}
run();
