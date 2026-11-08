import {
  GetObjectCommand,
  ListBucketsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";

const stored = new Map<string, string>();
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/")
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><ListAllMyBucketsResult><Owner><ID>me</ID></Owner><Buckets><Bucket><Name>first</Name><CreationDate>2020-01-01T00:00:00.000Z</CreationDate></Bucket></Buckets></ListAllMyBucketsResult>`,
        { headers: { "content-type": "application/xml" } },
      );
    if (request.method === "PUT")
      return (stored.set(pathname, await request.text()), new Response(null, { headers: { etag: '"abc"' } }));
    const body = stored.get(pathname);
    if (body === undefined)
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>`,
        { status: 404, headers: { "content-type": "application/xml" } },
      );
    return new Response(body, { headers: { "content-type": "text/plain", etag: '"abc"' } });
  },
});
const client = new S3Client({
  region: "us-east-1",
  endpoint: `http://localhost:${server.port}`,
  forcePathStyle: true,
  credentials: { accessKeyId: "a", secretAccessKey: "b" },
  maxAttempts: 1,
});
const { Buckets } = await client.send(new ListBucketsCommand({}));
console.log(Buckets?.map(bucket => `${bucket.Name} ${bucket.CreationDate?.toISOString()}`).join());
const put = await client.send(new PutObjectCommand({ Bucket: "first", Key: "hello.txt", Body: "Hello S3" }));
console.log(put.ETag, put.$metadata.httpStatusCode);
const got = await client.send(new GetObjectCommand({ Bucket: "first", Key: "hello.txt" }));
console.log(await got.Body?.transformToString(), got.ContentType);
try {
  await client.send(new GetObjectCommand({ Bucket: "first", Key: "missing" }));
} catch (error) {
  console.log(
    error instanceof S3ServiceException,
    (error as S3ServiceException).name,
    (error as S3ServiceException).$metadata.httpStatusCode,
  );
}
client.destroy();
server.stop(true);
