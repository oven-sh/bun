# bun-lambda

A custom runtime layer that runs Bun on AWS Lambda.

## Setup

First, you will need to deploy the layer to your AWS account. Clone this repository and run the `publish-layer` script to get started.

```sh
git clone git@github.com:oven-sh/bun.git
cd packages/bun-lambda
bun install
bun run publish-layer
```

### `bun run build-layer`

Builds a Lambda layer for Bun and saves it to a `.zip` file.

| Flag        | Description                                                          | Default                |
| ----------- | -------------------------------------------------------------------- | ---------------------- |
| `--arch`    | The architecture to support, either: "x64" or "aarch64"              | aarch64                |
| `--release` | The release of Bun, can be: "latest", "canary", or a release "x.y.z" | latest                 |
| `--output`  | The path to write the layer as a `.zip`.                             | ./bun-lambda-layer.zip |

Example:

```sh
bun run build -- \
  --arch x64 \
  --release canary \
  --output /path/to/layer.zip
```

### `bun run publish-layer`

Builds a Lambda layer for Bun then publishes it to your AWS account.

| Flag       | Description                      | Default |
| ---------- | -------------------------------- | ------- |
| `--layer`  | The name of the layer.           | bun     |
| `--region` | The region to publish the layer. |         |
| `--public` | If the layer should be public.   | false   |

Example:

```sh
bun run publish -- \
  --arch aarch64 \
  --release latest \
  --output /path/to/layer.zip \
  --region us-east-1
```

## Usage

Once you publish the layer to your AWS account, you can create a Lambda function that uses the layer.

Here's an example function that can run on Lambda using the layer for Bun:

```ts
export default {
  async fetch(request: Request): Promise<Response> {
    return new Response("Hello from Lambda!");
  },
};
```
