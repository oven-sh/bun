import { MongoClient } from "mongodb";
import { fakeMongo } from "./fake_mongo.ts";
import { listen } from "./lib_http.ts";

const seen: string[] = [];
const server = fakeMongo(seen);
const port = await listen(server);
const client = new MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`, { serverSelectionTimeoutMS: 5000 });
await client.connect();
const people = client.db("d").collection<{ _id: number; name: string }>("people");
console.log(JSON.stringify(await people.insertMany([{ _id: 1, name: "ada" }, { _id: 2, name: "grace" }])));
console.log(JSON.stringify(await people.find({ name: "ada" }).toArray()));
console.log(JSON.stringify(await people.findOne({ _id: 2 })));
console.log(await people.countDocuments());
console.log(JSON.stringify(await people.updateOne({ _id: 1 }, { $set: { name: "x" } })));
await client.close();
server.close();
console.log(seen.join(" | "));
console.log("DONE");
