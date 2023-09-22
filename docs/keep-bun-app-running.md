## Running a JS/TS Web Server as a Daemon with PM2 and Bun

[PM2](https://pm2.keymetrics.io/) is a popular process manager for Node.js applications that allows you to easily manage and run your applications as daemons. In this section, we'll guide you through running your JavaScript or TypeScript web server with PM2 using Bun as the interpreter.

### What is PM2?

PM2 is a production-ready process manager that simplifies the deployment and management of Node.js applications. It offers features like process monitoring, automatic restarts, and easy scaling.

### When to Use PM2?

You should consider using PM2 when you need to:

- Keep your Node.js application running continuously.
- Ensure high availability and reliability of your application.
- Monitor and manage multiple processes with ease.
- Simplify the deployment process.

### How to Use PM2 with Bun

You can use PM2 with Bun in two ways: as a CLI option or in a configuration file.

#### Using PM2 as a CLI Option:

To start your application with PM2 and Bun as the interpreter, open your terminal and run the following command:

```bash
pm2 start --interpreter ~/.bun/bin/bun index.ts
```

This command tells PM2 to start your application (index.ts) using Bun as the interpreter.

Using PM2 in the Configuration File:

Alternatively, you can create a PM2 configuration file to specify the settings. Here’s how to do it:

	1.	Create a file named pm2.config.js in your project directory.
	2.	Open pm2.config.js and add the following content:

```javascript
module.exports = {
  name: 'app',              // Name of your application
  script: 'index.ts',      // Entry point of your application
  interpreter: '~/.bun/bin/bun', // Path to the Bun interpreter
}
```

	3.	Save the file.
	4.	Now, you can start your application with PM2 using the configuration file:
 
```bash
pm2 start pm2.config.js
```
That’s it! Your JavaScript/TypeScript web server is now running as a daemon with PM2 using Bun as the interpreter.
