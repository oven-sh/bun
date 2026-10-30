// A thousand messages of node:http are made one after the other. The run time is asked for room for their fields a few times in all, not once a message.
// Todo: from the 502nd message on, each one calls operationAOTEnsureExtensionGranules: 519 calls
// COUNT: operation:operationAOTEnsureExtensionGranules <= 40
import http from "node:http";

let size = 0;
for (let i = 0; i < 1000; i++) size += new http.OutgoingMessage().outputSize;
console.log(size);
