# bun-lambda

A custom runtime layer that runs Bun on AWS Lambda.

## Setup

First, you will need to deploy the layer to your AWS account. Clone this repository and run the `publish-layer` script to get started.

```sh
git clone git@github.com:oven-sh/bun.git
cd bun/packages/bun-lambda
bun install
bun run publish-layer
```

### `bun run build-layer`

Builds a Lambda layer for Bun and saves it to a `.zip` file.

| Flag        | Description                                                          | Default                |
| ----------- | -------------------------------------------------------------------- | ---------------------- |
| `--arch`    | The architecture, either: "x64" or "aarch64"                         | aarch64                |
| `--release` | The release of Bun, either: "latest", "canary", or a release "x.y.z" | latest                 |
| `--output`  | The path to write the layer as a `.zip`.                             | ./bun-lambda-layer.zip |

Example:

```sh
bun run build-layer -- \
  --arch x64 \
  --release canary \
  --output /path/to/layer.zip
```

### `bun run publish-layer`

Builds a Lambda layer for Bun then publishes it to your AWS account.

| Flag       | Description                               | Default |
| ---------- | ----------------------------------------- | ------- |
| `--layer`  | The layer name.                           | bun     |
| `--region` | The region name, or "\*" for all regions. |         |
| `--public` | If the layer should be public.            | false   |

Example:

```sh
bun run publish-layer -- \
  --arch aarch64 \
  --release latest \
  --output /path/to/layer.zip \
  --region us-east-1
```

## Usage

Once you publish the layer to your AWS account, you can create a Lambda function that uses the layer.

Here's an example function that can run on Lambda using the layer for Bun:

### HTTP events

When an event is triggered from [API Gateway](https://docs.aws.amazon.com/lambda/latest/dg/services-apigateway.html), the layer transforms the event payload into a [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request). This means you can test your Lambda function locally using `bun run`, without any code changes.

```ts
export default {
  async fetch(request: Request): Promise<Response> {
    console.log(request.headers.get("x-amzn-function-arn"));
    // ...
    return new Response("Hello from Lambda!", {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  },
};
```

### Non-HTTP events

For non-HTTP events — S3, SQS, EventBridge, etc. — the event payload is the body of the [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request).

```ts
export default {
  async fetch(request: Request): Promise<Response> {
    const event = await request.json();
    // ...
    return new Response();
  },
};
```
