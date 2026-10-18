class Message {
  url = "/";
  status = 200;
  sent = false;
  next: Message | null = null;
}
class Other {
  url = 5;
  more = "more";
}
const messages: any[] = [];
for (let i = 0; i < 4; i++) messages.push(new Message());
const byIndex: any[] = [];
for (let i = 0; i < 4; i++) byIndex[i] = new Message();
const mixed: any[] = [];
mixed.push(new Message(), new Other(), { url: "plain", status: "text" }, null, 7);
const write = (message: any, url: any, status: any, sent: any, next: any) => {
  message.url = url;
  message.status = status;
  message.sent = sent;
  message.next = next;
};
const read = (message: any) => message.url + " " + message.status + " " + message.sent + " " + (message.next === null);
const attempt = (label: string, run: () => unknown) => {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, error instanceof TypeError ? "TypeError" : String(error));
  }
};
for (let i = 0; i < messages.length; i++) {
  write(messages[i], "/a" + i, 404 + i, true, messages[0]);
  console.log(read(messages[i]), read(byIndex[i]));
}
for (let i = 0; i < mixed.length; i++) attempt("mixed " + i, () => read(mixed[i]));
for (let i = 0; i < mixed.length; i++) attempt("mixed written " + i, () => { write(mixed[i], "/b", 1, false, null); return read(mixed[i]); });
attempt("a text for the number", () => { write(messages[1], "/c", "text", true, null); return read(messages[1]); });
messages.length = 0;
attempt("beyond the end", () => read(messages[0]));
messages.push("a text");
attempt("a text", () => read(messages[0]));
