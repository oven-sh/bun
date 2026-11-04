console.log(new Blob(["a"]).stream().pipeThrough(new TextDecoderStream()));
