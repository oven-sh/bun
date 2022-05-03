#!/bin/bash

rm -rf plus100-napi
git clone https://github.com/Jarred-Sumner/napi-plus100 plus100-napi --depth=1
cd plus100-napi
npm install
npm run build
