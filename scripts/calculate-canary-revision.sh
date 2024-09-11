#!/usr/bin/env bash
if [ -z "$GITHUB_TOKEN" ]; then
  echo "GITHUB_TOKEN is not set"
  exit 1
fi

query="\"query{repository(owner:\\\"oven-sh\\\",name:\\\"bun\\\"){releases(first:1){edges{node{tagName}}}}}\""
tagName=$(curl -fsSL "https://api.github.com/graphql" -X POST -d '{"query":'${query}'}' \
  -H "Authorization: bearer ${GITHUB_TOKEN}" -H "Content-Type: application/json" \
  | jq -r '.data.repository.releases.edges[0].node.tagName')

if [ -z "$headRef" ]; then
  headRef=$(git rev-parse HEAD)
fi

query="\"query{repository(owner:\\\"oven-sh\\\",name:\\\"bun\\\"){ref(qualifiedName:\\\"${tagName}\\\"){compare(headRef:\\\"${headRef}\\\"){aheadBy}}}}\""
aheadBy=$(curl -fsSL "https://api.github.com/graphql" -X POST -d '{"query":'${query}'}' \
  -H "Authorization: bearer ${GITHUB_TOKEN}" -H "Content-Type: application/json" \
  | jq -r '.data.repository.ref.compare.aheadBy')

if [ "$1" == '--raw' ]; then
  if [ "$aheadBy" == "null" ]; then
    echo "1"
  else
    echo "${aheadBy}"
  fi
else
  echo "Latest version is ${tagName}"
  if [ "$aheadBy" == "null" ]; then
    echo "Current commit is not available on GitHub.com"
  else
    echo "Ahead by ${aheadBy} commits."
  fi
  echo "(call script with --raw to print just a number)"
fi