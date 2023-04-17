import { SlashCommand, ComponentType, TextInputStyle } from 'slash-create';

export default class ModalCommand extends SlashCommand {
  constructor(creator) {
    super(creator, {
      name: 'modal',
      description: 'Send a cool modal.'
    });

    this.filePath = __filename;
  }

  async run(ctx) {
    // You can send a modal this way
    // Keep in mind providing a callback is optional, but no callback requires the custom_id to be defined.
    ctx.sendModal(
      {
        title: 'Example Modal',
        components: [
          {
            type: ComponentType.ACTION_ROW,
            components: [
              {
                type: ComponentType.TEXT_INPUT,
                label: 'Text Input',
                style: TextInputStyle.SHORT,
                custom_id: 'text_input',
                placeholder: 'Type something...'
              }
            ]
          },
          {
            type: ComponentType.ACTION_ROW,
            components: [
              {
                type: ComponentType.TEXT_INPUT,
                label: 'Long Text Input',
                style: TextInputStyle.PARAGRAPH,
                custom_id: 'long_text_input',
                placeholder: 'Type something...'
              }
            ]
          }
        ]
      },
      (mctx) => {
        mctx.send(`Your input: ${mctx.values.text_input}\nYour long input: ${mctx.values.long_text_input}`);
      }
    );
  }
}