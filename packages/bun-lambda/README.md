# bun-lambda

A custom runtime layer that runs Bun on AWS Lambda.

## Setup

First, you will need to deploy the layer to your AWS account. Clone this repository and run the `publish-layer` script to get started. Note: the `publish-layer` script also builds the layer.

```sh
git clone --filter=blob:none --sparse https://github.com/oven-sh/bun.git
git -C bun sparse-checkout set packages/bun-lambda
cd bun/packages/bun-lambda
bun install
bun run publish-layer
```

## Usage

Once you publish the layer to your AWS account, you can create a Lambda function that uses the layer.

### Step 1: Create a Bun Lambda handler function

In addition to providing the Bun runtime itself, the Bun Lambda Layer also provides an event transformation so you can write your Bun function in a classic Bun server format. This allows you to also run your Lambda function as a local Bun server with `bun run <handler-name>.ts`. Here are some examples of how to write a Bun Lambda function:

#### HTTP Event Example

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

#### Non-HTTP Event Example

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

### Step 2: Build the Bun handler

The final step is to upload your Bun handler. You can technically write the handler directly in the console if you wish, but if you want a full development environment, use the Bun toolkit. There are several ways you can choose to build and manage your artifacts, but follow these steps for a simple approach:

1. Run `bun build <handler-entry>.[ts|js] --outfile ./dist/handler.js`
2. Zip the `/dist` folder

### Step 3: Create the Lambda function on AWS

Once you've written your Lambda function, you need to configure a new Lambda function to use Bun. The following steps apply to configuring in the console, CloudFormation, CDK, Terraform, or any other configuration management option for AWS:

1. Create the Lambda function
2. Set the Runtime to custom with Amazon Linux 2
3. Set the handler to <handler-file-name>.fetch (e.g. if your bundled Bun handler is at `handler.js`, set the handler as `handler.fetch`)
4. Set the architecture to whichever architecture you configured when you built/deployed the Lambda Layer
5. Attach the Lambda Layer to your new function
6. Upload the zip file from step 2. You can do this in the console directly, upload to S3 and set that as the location for the handler file in Lambda, or use something like CDK to manage this for you.

## API

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
