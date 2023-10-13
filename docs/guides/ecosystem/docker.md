---
name: Containerize a bun application using Docker
---

[Docker](https://www.docker.com) is a set of platform as a service products that use OS-level virtualization to deliver software in packages called containers. The service has both free and premium tiers.

---

For this first you need to install Docker Desktop to can build docker images, this can be downloaded from their [official web application](https://www.docker.com/products/docker-desktop/)

---

Now that you have docker, we can start writing the `Dockerfile`, this file should be in the root of your application, a basic `Dockerfile` that uses a build stage can be this, if you don't need a build stage you can remove it from the file.

```dockerfile#Dockerfile
# * Here we use the official image of bun which already has bun installed, you can specify the exact version
# * Like 1.0.6-debian or always get the latest version with debian e.g. FROM oven/bun:debian as base
# * Getting always the latest is not such a great idea as it might introduce breaking changes
# * You have 2 more options which are 1-debian and 1.0-aline, which will use the version 1.x.x (Latest minor version) or 1.0.x (Latest revision version)
FROM oven/bun:1.0.6-debian as base
WORKDIR /usr/src/app

# * Install the deps in temp to cache them and speed up the build
FROM base AS install
# * Install both devDependencies and dependencies
RUN mkdir -p /temp/dev
COPY package.json bun.lockb /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

# * Install for production use only dependencies
RUN mkdir -p /temp/prod
COPY package.json bun.lockb /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# * In this stage you can test/build your application
# * This step is optional if you don't test your application or build it
FROM install AS prerelease
# * Copy all the deps from temp
COPY --from=install /temp/dev/node_modules node_modules
# * This command copies all the files in the current directory to the image except the ones in .dockerignore
COPY . .

# * Optional steps to test your app before building
RUN bun test
ENV NODE_ENV=production
# * You can call the build command here if you want to build your app

# Release
FROM base AS release
# * Copy only the packages requried for running the application, such as
# * node_modules without dev dependencies to keep the image size minimal
COPY --from=install /temp/prod/node_modules node_modules

# * This will copy all the ts files to the root of the image, if you have a directory with your ts/js files
# * You can copy the whole directory instead of each file
# * COPY --from=prerelease /usr/src/app/DIR_NAME DIR_NAME
# * If you do bot use the prerelease stage, remove the `--from=prerelease /usr/src/app/` as you can only copy them from the project files e.g. `COPY *.ts .`
COPY --from=prerelease /usr/src/app/*.ts .
COPY --from=prerelease /usr/src/app/package.json .

# * Is better to define a different user than root to run your app
USER bun
ENV NODE_ENV=production

# * Expose the port your app is running on
EXPOSE 3000/tcp

# * Point to the file you want to run
ENTRYPOINT [ "bun", "run", "index.ts" ]
```

---

Now that you have your docker image, let's look at `.dockerignore` which has the same syntax as `.gitignore`, here you need to specify the files/directories that must not go in any stage of the docker build. An example for a ignore file is

```ignore#.dockerignore
node_modules
Dockerfile*
docker-compose*
.dockerignore
.git
.gitignore
README.md
LICENSE
.vscode
Makefile
helm-charts
.env
.editorconfig
.idea
coverage*
```

---

Now let's build the image, the first build will always take longer as Docker will have to download all the deps and bun image, the second build if there is no build or dependency changes, can take few seconds.

The `latest` tag is where you put your version of the image, you can stay with latest or specify an exact version as `1.0.0`, Note that if you have 2 images with the same name and tag, the older one will have the name removed but still use space on your system

```bash
$ docker build --pull --rm -f "Dockerfile" -t your-image-name:latest "."
[+] Building 1.4s (19/19) FINISHED
```

---

Now that you have builded your image, you can use docker desktop to create a container for the image and run the application, Note that in order to access the http/ws port, you need to specify the container port to point to the app port

And that is it! Now with your docker image is not mandatory to create a docker container, you can also use Kubernetes, also known as K8s, which is an open-source system for automating deployment, scaling, and management of containerized applications.
