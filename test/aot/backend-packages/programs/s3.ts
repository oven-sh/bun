import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import http from "node:http";
import { listen, readBody } from "./lib_http.ts";

const seen: string[] = [];
const server = http.createServer(async (request, response) => {
  const body = await readBody(request);
  seen.push(`${request.method} ${request.url} signed:${String(request.headers.authorization).startsWith("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/")} crc32:${request.headers["x-amz-checksum-crc32"] ?? "-"} bytes:${body.length}`);
  if (request.method === "PUT") { response.setHeader("ETag", '"abc"'); response.end(); }
  else if (request.url!.includes("list-type=2")) {
    response.setHeader("Content-Type", "application/xml");
    response.end('<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>b</Name><KeyCount>2</KeyCount><IsTruncated>false</IsTruncated><Contents><Key>one.txt</Key><Size>3</Size></Contents><Contents><Key>two.txt</Key><Size>5</Size></Contents></ListBucketResult>');
  } else { response.setHeader("Content-Type", "text/plain"); response.setHeader("ETag", '"abc"'); response.end("hello object"); }
});
const port = await listen(server);
const s3 = new S3Client({ region: "us-east-1", endpoint: `http://127.0.0.1:${port}`, forcePathStyle: true, credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "not-a-secret" }, maxAttempts: 1 });

console.log((await s3.send(new PutObjectCommand({ Bucket: "b", Key: "one.txt", Body: "abc" }))).ETag);
const got = await s3.send(new GetObjectCommand({ Bucket: "b", Key: "one.txt" }));
console.log(got.ContentType, await got.Body!.transformToString());
const listed = await s3.send(new ListObjectsV2Command({ Bucket: "b", Prefix: "" }));
console.log(listed.KeyCount, JSON.stringify(listed.Contents?.map(object => [object.Key, object.Size])));
s3.destroy();
server.close();
console.log(seen.join("\n"));
console.log("DONE");
