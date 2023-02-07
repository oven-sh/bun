# bun-lambda

A custom runtime layer that runs Bun on AWS Lambda.

## Setup

First, you will need to deploy the runtime layer to your AWS account. Clone the repository and run the build script to get started.

```sh
git clone git@github.com:oven-sh/bun.git
cd packages/bun-lambda
bun install
bun run build
```

If you want to create a layer for a specific version of Bun, you can pass the release as an argument.

```sh
bun run build -- bun-v0.5.4
```

The `build` script uses [`serverless`](https://www.serverless.com/) to deploy the layer to your AWS account. If you have not used it before, you may need to login or sign up.

```sh
bunx serverless login
```

## Usage

You don't need to make any changes to your Bun code for it to work on Lambda.

```ts
export default {
  async fetch(request: Request): Promise<Response> {
    return new Response("Hello from AWS Lambda!");
  },
};
```
