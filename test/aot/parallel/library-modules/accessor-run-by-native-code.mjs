import { MIMEType } from "node:util";
const box = JSON.parse("{}");
box.type = new MIMEType("text/plain;charset=utf-8");
console.log(JSON.stringify(box), "" + box.type, [...box.type.params]);
