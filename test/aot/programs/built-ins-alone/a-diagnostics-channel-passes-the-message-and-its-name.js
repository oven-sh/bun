import { channel } from "node:diagnostics_channel";
const news = channel("news");
news.subscribe((message, name) => console.log(message.size + 1, name));
news.publish({ size: 1.5 });
