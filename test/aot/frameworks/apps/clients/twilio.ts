import twilio from "twilio";

const response = new twilio.twiml.VoiceResponse();
response.say({ voice: "alice" }, "Hello World");
response.dial().number("+15551234567");
console.log(response.toString());
const message = new twilio.twiml.MessagingResponse();
message.message("The Robots are coming!");
console.log(message.toString());
const url = "https://example.com/myapp.php?foo=1&bar=2";
const params = {
  CallSid: "CA1234567890ABCDE",
  Caller: "+14158675310",
  Digits: "1234",
  From: "+14158675310",
  To: "+18005551212",
};
console.log(
  twilio.validateRequest("12345", "0/KCTR6DLpKmkAf8muzZqo1nDgQ=", url, params),
  twilio.validateRequest("12345", "wrong", url, params),
);
const client = twilio("ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "token", { lazyLoading: true });
console.log(typeof client.messages.create, client.accountSid);
