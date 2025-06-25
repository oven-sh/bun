Upgrade the self-reported version of Node.js in Bun from 22.6.0 to 24.3.0.

This will involve:

- Updating the CI machines to use this version of Node.js in the bootstrap and/or Docker images
- Updating the process.versions field to match the output of a Node.js executable (plus Bun's other existing version fields)
- Updating the N-API module API versions to match the Node.js versions. Print `process.config` in both Bun and Node.js and check they roughly match up. Print `process.report.getReport()` in both Bun and Node.js and check they roughly match up.
- Run the napi.test.js file to make sure all the tests still match the updated Node.js version's behavior
- Audit all usages of the V8 C++ API in Bun to verify we continue to match up the V8 API from the Node.js version. Be extremely thorough or you will cause users applications to crash in production which can cause real-life financial and physical harm to people.
