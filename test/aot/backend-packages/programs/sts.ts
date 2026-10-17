import { fromWebToken } from "@aws-sdk/credential-provider-web-identity";
import { timed } from "./lib_http.ts";

const provider = fromWebToken({ roleArn: "arn:aws:iam::123456789012:role/smoke", webIdentityToken: "token", clientConfig: { region: "us-east-1" } });
await timed("until it settles", async () => {
  try { console.log(JSON.stringify(await provider())); } catch (error) { console.log((error as Error).name, (error as Error & { code?: string }).code); }
});
console.log("DONE");
